from app.collector.bundle import record

DISCOVERY = (
    ("ec2", "describe_instances", "Reservations", "InstanceId", "instance", "AWS::EC2::Instance"),
    ("ec2", "describe_vpcs", "Vpcs", "VpcId", "vpc", "AWS::EC2::VPC"),
    ("ec2", "describe_subnets", "Subnets", "SubnetId", "subnet", "AWS::EC2::Subnet"),
    (
        "ec2",
        "describe_security_groups",
        "SecurityGroups",
        "GroupId",
        "security-group",
        "AWS::EC2::SecurityGroup",
    ),
    (
        "ec2",
        "describe_route_tables",
        "RouteTables",
        "RouteTableId",
        "route-table",
        "AWS::EC2::RouteTable",
    ),
    (
        "ec2",
        "describe_network_interfaces",
        "NetworkInterfaces",
        "NetworkInterfaceId",
        "network-interface",
        "AWS::EC2::NetworkInterface",
    ),
    (
        "ec2",
        "describe_nat_gateways",
        "NatGateways",
        "NatGatewayId",
        "natgateway",
        "AWS::EC2::NatGateway",
    ),
    (
        "elbv2",
        "describe_load_balancers",
        "LoadBalancers",
        "LoadBalancerArn",
        "",
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
    ),
    ("rds", "describe_db_instances", "DBInstances", "DBInstanceArn", "", "AWS::RDS::DBInstance"),
    ("lambda", "list_functions", "Functions", "FunctionArn", "", "AWS::Lambda::Function"),
)


def discover(session, account, region, retry, report):
    partition = session.get_partition_for_region(region)
    records = []
    for service, operation, collection, identifier, prefix, resource_type in DISCOVERY:
        count = 0
        try:
            client = session.client(service, region_name=region, config=retry)
            pages = (
                client.get_paginator(operation).paginate()
                if client.can_paginate(operation)
                else [getattr(client, operation)()]
            )
            for page in pages:
                items = page.get(collection, [])
                if collection == "Reservations":
                    items = [i for reservation in items for i in reservation.get("Instances", [])]
                for item in items:
                    identity = item[identifier]
                    arn = (
                        identity
                        if identity.startswith("arn:")
                        else (f"arn:{partition}:{service}:{region}:{account}:{prefix}/{identity}")
                    )
                    records.append(
                        record(
                            "describe",
                            {
                                "arn": arn,
                                "accountId": account,
                                "awsRegion": region,
                                "resourceType": resource_type,
                                "tags": item.get("Tags", []),
                                "configuration": item,
                            },
                            operation,
                        )
                    )
                    count += 1
            report("complete", operation, count)
        except Exception as exc:
            report("partial" if count else "error", f"{operation}: {exc}", count)
    return records


def discover_buckets(session, account, region, retry, report):
    records = []
    try:
        client = session.client("s3", region_name=region, config=retry)
        pages = (
            client.get_paginator("list_buckets").paginate()
            if client.can_paginate("list_buckets")
            else [client.list_buckets()]
        )
        partition = session.get_partition_for_region(region)
        for page in pages:
            for bucket in page.get("Buckets", []):
                name = bucket["Name"]
                try:
                    location = bucket.get("BucketRegion")
                    if not location:
                        location = client.get_bucket_location(Bucket=name).get("LocationConstraint")
                    location = "eu-west-1" if location == "EU" else location or "us-east-1"
                    records.append(
                        record(
                            "describe",
                            {
                                "arn": f"arn:{partition}:s3:::{name}",
                                "accountId": account,
                                "awsRegion": location,
                                "resourceType": "AWS::S3::Bucket",
                                "resourceId": name,
                                "resourceName": name,
                                "configuration": {"location": location},
                            },
                            "list_buckets/get_bucket_location",
                        )
                    )
                except Exception as exc:
                    report("partial", f"{name}: {exc}", 0)
        report("complete", "list_buckets", len(records))
    except Exception as exc:
        report("partial" if records else "error", f"list_buckets: {exc}", len(records))
    return records
