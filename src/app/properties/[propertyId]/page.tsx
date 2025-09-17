import { PropertyDetails } from "../../../components/property-details";

export default async function PropertyDetailsPage({ params }: { params: { propertyId: string } }) {
    const { propertyId } = await params;

    return (
        <div>
            <PropertyDetails propertyId={propertyId} />
        </div>
    );
}
    